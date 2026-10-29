import { Router } from "express";
import authController from "../controllers/auth.controller.js";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import {
    forgotPasswordLimiter,
    loginLimiter,
    passwordCheckLimiter,
    registerLimiter,
    resetPasswordLimiter,
} from "../middlewares/rateLimit.middleware.js";

const authRouter = Router();

authRouter.route('/register')
    .post(registerLimiter, authController.register);

authRouter.route('/login')
    .post(loginLimiter, authController.login);

// Mot de passe oublié (public)
authRouter.route('/forgot-password')
    .post(forgotPasswordLimiter, authController.forgotPassword);

authRouter.route('/reset-password')
    .post(resetPasswordLimiter, authController.resetPassword);

authRouter.route('/update-pwd')
    .post(authorizeMiddleware(), passwordCheckLimiter, authController.updatePassword);

authRouter.route('/me')
    .get(authorizeMiddleware(), authController.me);


export default authRouter;
