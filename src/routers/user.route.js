import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";
import upload from "../middlewares/upload.middleware.js";

const userRouter = Router();

userRouter
  .route("/me")
  .get(authorizeMiddleware(), userController.me)
  .patch(
    authorizeMiddleware(),
    upload.single("avatar"),
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