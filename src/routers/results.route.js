import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import resultsController from "../controllers/results.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";

const resultsRouter = Router();

resultsRouter.param("gameId", uuidParam);

resultsRouter
    .route('/:gameId/results')
    .get(authorizeMiddleware(), resultsController.getResults)
    .post(authorizeMiddleware(), resultsController.createResults);

export default resultsRouter;