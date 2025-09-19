import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";

const userRouter = Router();

userRouter
  .route("/:id")
  .get(userController.getUser)

userRouter
  .route("/me")
  .get(authorizeMiddleware(), userController.me)
  .put(authorizeMiddleware(), userController.updateMe)
  .delete(authorizeMiddleware(), userController.deleteMe);

userRouter.route("/")
  .get(userController.getAllUsers);

export default userRouter;