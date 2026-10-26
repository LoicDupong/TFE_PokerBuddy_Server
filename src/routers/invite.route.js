import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import inviteController from "../controllers/invite.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";

const inviteRouter = Router();

inviteRouter.param("gameId", uuidParam);
inviteRouter.param("inviteId", uuidParam);

// Liste ou ajout d'invitations
inviteRouter
  .route("/:gameId/invites")
  .post(authorizeMiddleware(), inviteController.invitePlayer)
  .get(authorizeMiddleware(), inviteController.getInvitesList);

// Mes invitations (route spécifique avant la route paramétrée)
inviteRouter
  .route("/invites/me")
  .get(authorizeMiddleware(), inviteController.getMyInvites);

// Confirmation d'une invitation
inviteRouter
  .route("/invites/:inviteId")
  .patch(authorizeMiddleware(), inviteController.respondInvite);

export default inviteRouter;
