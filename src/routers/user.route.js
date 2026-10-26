import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";
import { uploadAvatar } from "../middlewares/upload.middleware.js";
import { uuidParam } from "../middlewares/validate.middleware.js";

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
  .delete(authorizeMiddleware(), userController.deleteMe);

// 🔹 recherche par username
userRouter
  .route('/search')
  .get(authorizeMiddleware(), userController.searchByUsername);

userRouter
  .route("/:id")
  .get(userController.getUser);

export default userRouter;