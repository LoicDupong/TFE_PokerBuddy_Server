import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import gameController from "../controllers/game.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";


const gameRouter = Router();

gameRouter.param("id", uuidParam);

gameRouter
    .route('/')
    .get(authorizeMiddleware(),gameController.getAllGames)
    .post(authorizeMiddleware(), gameController.createGame);

gameRouter
    .route('/:id/ics')
    .get(gameController.getGameIcs);

gameRouter
    .route('/:id/invite-code')
    .post(authorizeMiddleware(), gameController.generateInviteCode)
    .delete(authorizeMiddleware(), gameController.disableInviteCode);

gameRouter
    .route('/:id')
    .get(authorizeMiddleware(), gameController.getGameById)
    .patch(authorizeMiddleware(), gameController.updateGame)
    .delete(authorizeMiddleware(), gameController.deleteGame);


export default gameRouter;