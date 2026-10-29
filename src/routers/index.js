import { Router } from "express";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import gameRouter from "./game.route.js";
import inviteRouter from "./invite.route.js";
import resultsRouter from "./results.route.js";
import friendRouter from "./friend.route.js";
import notificationRouter from "./notification.route.js";
import leaderboardRouter from "./leaderboard.route.js";
import joinRouter from "./join.route.js";
import financeRouter from "./finance.route.js";
import adminRouter from "./admin.route.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/user", userRouter);
apiRouter.use("/games", gameRouter);
apiRouter.use("/games", inviteRouter);
apiRouter.use("/games", resultsRouter);
apiRouter.use("/games", financeRouter);
apiRouter.use("/friends", friendRouter);
apiRouter.use("/notifications", notificationRouter);
apiRouter.use("/leaderboard", leaderboardRouter);
apiRouter.use("/join", joinRouter);
apiRouter.use("/admin", adminRouter);