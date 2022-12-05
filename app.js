const express = require("express");
const app = express();
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
app.use(express.json());

const filePath = path.join(__dirname, "/twitterClone.db");
//initialize DB
let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: filePath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server started successfully");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
  }
};
initializeDbAndServer();

//authentication middleware

const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  if (authHeader === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    const jwtToken = authHeader.split(" ")[1];
    switch (true) {
      case jwtToken === undefined:
        response.status(401);
        response.send("Invalid JWT Token");
        break;
      case jwtToken !== undefined:
        //compare jwt token
        const isJwtTokenMatched = jwt.verify(
          jwtToken,
          "MY_SECRET_KEY",
          async (error, payload) => {
            if (error) {
              response.status(401);
              response.send("Invalid JWT Token");
            } else {
              request.username = payload.username;
              next();
            }
          }
        );

        break;
    }
  }
};

//User registration
app.post("/register/", async (request, response) => {
  const userDetails = request.body;
  const { username, password, name, gender } = userDetails;
  //check if username already registered
  const getUserQuery = `
                        SELECT * 
                        FROM user
                        WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);
  switch (true) {
    case dbUser === undefined:
      if (password.length < 6) {
        response.status(400);
        response.send("Password is too short");
      } else {
        //Register User

        const payload = { username: username };
        const hashedPassword = await bcrypt.hash(password, 10);
        const insertUserQuery = `INSERT INTO user(username,password,name,gender)
    VALUES(
        '${username}','${hashedPassword}','${name}','${gender}'
    );`;
        await db.run(insertUserQuery);
        response.send("User created successfully");
      }
      break;
    case dbUser !== undefined:
      //User already exist/invalid username
      response.status(400);
      response.send("User already exists");
      break;
  }
});

//user login

app.post("/login", async (request, response) => {
  const userDetails = request.body;
  const { username, password } = userDetails;
  const getUserQuery = `SELECT * 
                            FROM user 
                            WHERE username  = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  switch (true) {
    case dbUser === undefined:
      //user not registered
      response.status(400);
      response.send("Invalid user");
      break;
    case dbUser !== undefined:
      //user registered -->check password
      const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
      if (isPasswordMatched) {
        //generate JWT
        const payload = { username: username };
        const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
        response.send({ jwtToken });
      } else {
        //invalid password
        response.status(400);
        response.send("Invalid password");
      }
  }
});

//GET  the latest tweets of people whom the user follows

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT *
                        FROM user 
                        WHERE username = '${username}';`;
  const userDetails = await db.get(getUserIdQuery);
  const { user_id } = userDetails;

  const getTweetsQuery = `SELECT username,tweet,date_time AS dateTime
                        FROM (user INNER JOIN follower ON user.user_id = follower.following_user_id) AS T NATURAL JOIN tweet
                        WHERE follower_user_id = ${user_id}
                        ORDER BY dateTime DESC
                        LIMIT 4;
                        `;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT *
                        FROM user 
                        WHERE username = '${username}';`;
  const userDetails = await db.get(getUserIdQuery);
  const { user_id } = userDetails;
  const getFollowingQuery = `SELECT name
                                    FROM user INNER JOIN follower 
                                    ON user.user_id = follower.following_user_id
                                    where follower_user_id = '${user_id}'
                                    ; `;
  const followingList = await db.all(getFollowingQuery);
  response.send(followingList);
});

//Returns the list of all names of people who follows the user
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT *
                        FROM user 
                        WHERE username = '${username}';`;
  const userDetails = await db.get(getUserIdQuery);
  const { user_id } = userDetails;
  const getFollowersQuery = `SELECT name
                                    FROM user INNER JOIN follower 
                                    ON follower.follower_user_id  = user.user_id
                                    where following_user_id = '${user_id}'
                                    ; `;
  const followersList = await db.all(getFollowersQuery);
  response.send(followersList);
});

//Function to check if user is following a particular user

const checkFollowing = async (username, tweeterId) => {
  const getUserDetailsQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const userDetails = await db.get(getUserDetailsQuery);
  const { user_id } = userDetails;

  const isFollowingQuery = `SELECT * 
                                FROM follower
                                WHERE follower.follower_user_id = '${user_id}'
                                AND follower.following_user_id = '${tweeterId}';`;
  const dbResponse = await db.get(isFollowingQuery);
  if (dbResponse === undefined) {
    //not following
    return false;
  } else {
    //following
    return true;
  }
};

//Tweets based on tweet id
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request.params;
  const username = request.username;
  //retrieve tweet
  const getTweetQuery = `SELECT  *
                                FROM 
                               tweet
                                WHERE tweet_id  = '${tweetId}'; `;
  const tweetDetails = await db.get(getTweetQuery);
  const { user_id } = tweetDetails;
  const tweetedUserId = user_id;

  const isFollowing = await checkFollowing(username, tweetedUserId);
  if (isFollowing) {
    // retrieve tweet details
    const getLikesRepliesQuery = `SELECT tweet,
                                         COUNT(like.like_id)  AS likes,
                                         COUNT(reply.reply_id) AS replies,
                                         date_time AS dateTime
                                        FROM (tweet LEFT JOIN reply 
                                        ON tweet.tweet_id = reply.tweet_id)
                                        AS T LEFT JOIN like ON tweet.tweet_id = like.tweet_id
                                        
                                        WHERE tweet.tweet_id = '${tweetId}'
                                        ;`;
    const tweetReplies = await db.get(getLikesRepliesQuery);
    response.send(tweetReplies);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

//list of users who liked the tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const username = request.username;
    //retrieve tweet
    const getTweetQuery = `SELECT  *
                                FROM 
                               tweet
                                WHERE tweet_id  = '${tweetId}'; `;
    const tweetDetails = await db.get(getTweetQuery);
    const { user_id } = tweetDetails;
    const tweetedUserId = user_id;

    const isFollowing = await checkFollowing(username, tweetedUserId);
    if (isFollowing) {
      //send who liked that tweet
      const getLikesQuery = `SELECT *
                                FROM like INNER JOIN user ON like.user_id = user.user_id
                                WHERE tweet_id = '${tweetId}';`;
      const dbResponse = await db.all(getLikesQuery);
      const namesList = [];
      for (let eachObj of dbResponse) {
        let name = eachObj.username;
        namesList.push(name);
      }
      response.send({
        likes: namesList,
      });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//list of users who replied to the tweet

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const username = request.username;
    //retrieve tweet
    const getTweetQuery = `SELECT  *
                                FROM 
                               tweet
                                WHERE tweet_id  = '${tweetId}'; `;
    const tweetDetails = await db.get(getTweetQuery);
    const { user_id } = tweetDetails;
    const tweetedUserId = user_id;

    const isFollowing = await checkFollowing(username, tweetedUserId);

    if (isFollowing) {
      //send who replied to the tweet
      const getRepliesQuery = `SELECT name,reply
                                FROM reply INNER JOIN user ON reply.user_id = user.user_id
                                WHERE tweet_id = '${tweetId}';`;
      const dbResponse = await db.all(getRepliesQuery);
      const repliesList = [];
      for (let eachObj of dbResponse) {
        repliesList.push(eachObj);
      }
      response.send({ replies: repliesList });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

//Returns a list of all tweets of the user

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT * 
                                FROM user 
                                WHERE username = '${username}';`;
  const userDetails = await db.get(getUserIdQuery);
  const { user_id } = userDetails;

  const getTweetsQuery = `SELECT tweet,
                            COUNT(like_id) AS likes,
                            COUNT(reply_id) AS replies,
                            date_time AS dateTime
                            FROM 
                               (tweet LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id) 
                               AS T LEFT JOIN like ON T.tweet_id = like.tweet_id 
                           
                            WHERE tweet.user_id = '${user_id}'
                            GROUP BY tweet.tweet_id;`;
  const tweetsList = await db.all(getTweetsQuery);
  response.send(tweetsList);
});

//Create a tweet in the tweet table

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const username = request.username;
  const getUserIdQuery = `SELECT * 
                                FROM user 
                                WHERE username = '${username}';`;
  const userDetails = await db.get(getUserIdQuery);
  const { user_id } = userDetails;

  const tweetDetails = request.body;
  const { tweet } = tweetDetails;
  const dateTime = new Date();

  const postTweetQuery = `INSERT INTO tweet(tweet,date_time,user_id)
                            VALUES('${tweet}','${dateTime}','${user_id}')
                            ; `;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});

module.exports = app;

//DELETE a tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;

    const username = request.username;
    const getUserIdQuery = `SELECT * 
                                FROM user 
                                WHERE username = '${username}';`;
    const userDetails = await db.get(getUserIdQuery);
    const { user_id } = userDetails;
    const userId = user_id;

    const getTweetQuery = `SELECT  user_id AS tweetedUserId
                                FROM 
                               tweet
                                WHERE tweet_id  = '${tweetId}'; `;
    const tweetDetails = await db.get(getTweetQuery);
    const { tweetedUserId } = tweetDetails;
    if (userId === tweetedUserId) {
      //remove the tweet
      const deleteTweetQuery = `DELETE FROM tweet 
                                    WHERE tweet_id = '${tweetId}';`;
      await db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
