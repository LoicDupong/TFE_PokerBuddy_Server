import { Router } from "express";
import authRouter from "./auth.route.js";

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/user', userRouter);