import { Router } from "express";
import { requireAdmin } from "../middlewares/auth.middleware.js";
import { uuidParam } from "../middlewares/validate.middleware.js";
import adminController from "../controllers/admin.controller.js";

// Back-office, monté sur /api/admin : 401 si non connecté, 403 si le rôle (relu en base) n'est pas admin.
// La sécurité repose entièrement ici, jamais sur le client.
const adminRouter = Router();

adminRouter.use(requireAdmin());
adminRouter.param("id", uuidParam);

// Comptes
adminRouter.get("/users", adminController.listUsers);
adminRouter.get("/users/:id", adminController.getUser);
adminRouter.patch("/users/:id/role", adminController.updateRole);
adminRouter.post("/users/:id/disable", adminController.disableUser);
adminRouter.post("/users/:id/enable", adminController.enableUser);
adminRouter.post("/users/:id/revoke-sessions", adminController.revokeSessions);
adminRouter.delete("/users/:id", adminController.deleteUser);

// Parties
adminRouter.get("/games", adminController.listGames);
adminRouter.get("/games/:id", adminController.getGame);
adminRouter.post("/games/:id/cancel", adminController.cancelGame);

// Journal d'audit
adminRouter.get("/audit-logs", adminController.listAuditLogs);

export default adminRouter;
