import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import friendController from "../controllers/friend.controller.js";

const friendRouter = Router();

// Lister ses amis
friendRouter.get("/", authorizeMiddleware(), friendController.getFriends);

// Supprimer un ami
friendRouter.delete("/:friendId", authorizeMiddleware(), friendController.removeFriend);

// Envoyer une demande d'ami / Lister les demandes reçues
friendRouter
    .post("/invite", authorizeMiddleware(), friendController.sendInvite)
    .get("/invite", authorizeMiddleware(), friendController.getInvites);

// Répondre à une demande (accept/decline)
friendRouter.patch("/invite/:inviteId", authorizeMiddleware(), friendController.respondInvite);


export default friendRouter;
