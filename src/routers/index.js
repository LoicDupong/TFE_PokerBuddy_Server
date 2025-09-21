import { Router } from "express";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import gameRouter from "./game.route.js";
import inviteRouter from "./invite.route.js";
import resultsRouter from "./results.route.js";
import friendRouter from "./friend.route.js";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/user", userRouter);
apiRouter.use("/games", gameRouter);
apiRouter.use("/games", inviteRouter);
apiRouter.use("/games", resultsRouter);
apiRouter.use("/friends", friendRouter);