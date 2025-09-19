import { Router } from "express";
import authController from "../controllers/auth.controller.js";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";

const authRouter = Router();

authRouter.route('/register')
    .post(authController.register);

authRouter.route('/login')
    .post(authController.login);

authRouter.route('/update-pwd')
    .post(authorizeMiddleware(), authController.updatePassword);

authRouter.route('/me')
    .get(authorizeMiddleware(), authController.me);


export default authRouter;