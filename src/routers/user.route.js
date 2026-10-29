import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";
import { uploadAvatar } from "../middlewares/upload.middleware.js";
import { uuidParam } from "../middlewares/validate.middleware.js";
import { passwordCheckLimiter } from "../middlewares/rateLimit.middleware.js";

const userRouter = Router();

userRouter.param("id", uuidParam);

userRouter
  .route("/me")
  .get(authorizeMiddleware(), userController.me)
  .patch(
    authorizeMiddleware(),
    uploadAvatar,
    userController.updateMe
  )
  // Body { password } : réauthentification ; 5 échecs max par compte et par 15 min
  .delete(authorizeMiddleware(), passwordCheckLimiter, userController.deleteMe);

// 🔹 recherche par username
userRouter
  .route('/search')
  .get(authorizeMiddleware(), userController.searchByUsername);

userRouter
  .route("/:id")
  .get(userController.getUser);

export default userRouter;