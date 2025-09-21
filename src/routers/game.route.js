import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import gameController from "../controllers/game.controller.js";


const gameRouter = Router();

gameRouter
    .route('/')
    .get(authorizeMiddleware(),gameController.getAllGames)
    .post(authorizeMiddleware(), gameController.createGame);

gameRouter
    .route('/:id')
    .get(authorizeMiddleware(), gameController.getGameById)
    .patch(authorizeMiddleware(), gameController.updateGame)
    .delete(authorizeMiddleware(), gameController.deleteGame);


export default gameRouter;