import { Router } from "express";
import helloWorldRouter from "./hello-world.route.js";

export const apiRouter = Router();

apiRouter.use('/message', helloWorldRouter);