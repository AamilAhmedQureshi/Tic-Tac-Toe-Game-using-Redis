const express = require("express");
const app = express();
const server = require("http").createServer(app);
const io = require("socket.io")(server, {
  cors: { origin: "*" },
  allowEIO3: true,
});
app.set("view engine", "ejs");
app.use("/public", express.static("public"));
const redis = require("redis");

/* ===========> redis <=========== */
const client = redis.createClient();
client.on("ready", function (error) {
  console.log("ready");
});
client.on("error", function (error) {
  console.error(error);
});
const subscriber = redis.createClient();
const publisher = redis.createClient();
subscriber.subscribe("message_channel");

/* =============> route <=================== */
app.get("/", (req, res) => {
  res.render("index");
});

/* ===========> subscriber <=========== */
subscriber.on("message", (channel, message) => {
  console.log("Subscriber received message in channel '" + channel + "':" + message);
  let messageData = JSON.parse(message);
  if (messageData.event == "game.begin") {
    io.to(messageData.user.id).emit(messageData.event, {
      symbol: messageData.user.symbol,
    });
  }
  if (messageData.event == "move.made") {
    io.to(messageData.id).emit(messageData.event, JSON.parse(messageData.data));
  }
  if (messageData.event == "opponent.left") {
    io.to(messageData.id).emit(messageData.event);
  }
});

/* ===========> Join Game <=========== */
function joinGame(socket) {
  let players, unmatched;
  return new Promise(async (resolve, reject) => {
    client.hgetall("key", (err, value) => {
      if (!value) {
        client.hmset("key", "unmatched", "", "players", JSON.stringify({}));
        players = {};
        unmatched = "";
      } else {
        players = JSON.parse(value.players);
        unmatched = value.unmatched;
      }

      players[socket.id] = {
        opponent: unmatched,
        id: socket.id,
        symbol: "X",
      };
      if (unmatched && unmatched != "") {
        players[socket.id].symbol = "O";
        players[unmatched].opponent = socket.id;
        unmatched = "";
      } else {
        unmatched = socket.id;
      }
      client.hmset("key", "unmatched", unmatched, "players", JSON.stringify(players));

      return resolve(true);
    });
  });
}

/* ===========> Opponent <=========== */
function getOpponent(socket) {
  return new Promise(async (resolve, reject) => {
    client.hgetall("key", function (err, value) {
      players = JSON.parse(value.players);
      if (!players[socket.id].opponent || players[socket.id].opponent == "") {
        return resolve();
      }
      console.log(players[players[socket.id].opponent]);
      return resolve(players[players[socket.id].opponent]);
    });
  });
}

/* ===========> socket connection <=========== */
let players;
io.on("connection", async (socket) => {
  console.log("New client connected:", socket.id);
  await joinGame(socket);
  let opponentObj = await getOpponent(socket);
  console.log("opponentObj-1:", opponentObj);
  if (opponentObj) {
    socket.emit("game.begin", { symbol: players[socket.id].symbol });

    publisher.publish(
      "message_channel",
      JSON.stringify({ event: "game.begin", user: opponentObj })
    );
  }

  socket.on("make.move", async (data) => {
    let opponentObj = await getOpponent(socket);
    console.log("opponentObj-2:", opponentObj);
    if (!opponentObj) {
      return;
    }
    socket.emit("move.made", data);
    publisher.publish(
      "message_channel",
      JSON.stringify({ event: "move.made", id: opponentObj.id, data: JSON.stringify(data) })
    );
  });

  socket.on("disconnect", async function () {
    let opponentObj = await getOpponent(socket);
    if (opponentObj) {
      socket.emit("opponent.left");
      publisher.publish(
        "message_channel",
        JSON.stringify({ event: "opponent.left", id: opponentObj.id })
      );
    }
  });
});

/* ===========> port <=========== */
const port = process.argv[2] || 3000;
server.listen(port, () => {
  console.log(`Server listening on port: ${port}`);
});
