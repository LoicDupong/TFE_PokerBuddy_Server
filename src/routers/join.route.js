import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import joinController from "../controllers/join.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";

const joinRouter = Router();

// Les codes d'invitation sont des UUID (randomUUID)
joinRouter.param("token", uuidParam);

joinRouter.route("/:token").post(authorizeMiddleware(), joinController.joinByToken);

export default joinRouter;
