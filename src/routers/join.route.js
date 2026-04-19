import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import joinController from "../controllers/join.controller.js";

const joinRouter = Router();

joinRouter.route("/:token").post(authorizeMiddleware(), joinController.joinByToken);

export default joinRouter;
