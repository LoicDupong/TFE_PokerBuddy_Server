import { Router } from "express";
import authRouter from "./auth.route.js";
import userRouter from "./user.route.js";
import gameRouter from "./game.route.js";

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);
apiRouter.use('/games', gameRouter);