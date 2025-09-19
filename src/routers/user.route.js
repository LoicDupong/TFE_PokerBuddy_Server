import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";

const userRouter = Router();

userRouter
  .route("/:id")
  .get(userController.getUser)
  .put(authorizeMiddleware(), userController.updateUser)
  .delete(authorizeMiddleware(), userController.deleteUser);

userRouter.route("/")
  .get(userController.getAllUsers);

export default userRouter;