import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import userController from "../controllers/user.controller.js";

const userRouter = Router();

userRouter.route("/")
  .get(userController.getAllUsers);

userRouter
.route("/me")
.get(authorizeMiddleware(), userController.me)
.patch(authorizeMiddleware(), userController.updateMe)
.put(authorizeMiddleware(), userController.deleteMe);

userRouter
  .route("/:id")
  .get(userController.getUser)
  

export default userRouter;