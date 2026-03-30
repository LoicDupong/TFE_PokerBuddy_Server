import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import notificationController from "../controllers/notification.controller.js";

const notificationRouter = Router();

notificationRouter.get("/", authorizeMiddleware(), notificationController.getMyNotifications);
notificationRouter.patch("/read-all", authorizeMiddleware(), notificationController.markAllRead);

export default notificationRouter;
