import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";

const userRouter = Router();

userRouter
  .route("/profile/:id")
  .get(userController.getProfile)
  .put(authMiddleware, userController.updateProfile)
  .delete(authMiddleware, userController.deleteProfile);

export default userRouter;