import { Router } from "express";
import { authorizeMiddleware } from "../middlewares/auth.middleware.js";
import financeController from "../controllers/finance.controller.js";
import { uuidParam } from "../middlewares/validate.middleware.js";

// Finances d'une partie : /api/games/:gameId/finance/…
const financeRouter = Router();

financeRouter.param("gameId", uuidParam);
financeRouter.param("financeOpId", uuidParam);

financeRouter.get("/:gameId/finance", authorizeMiddleware(), financeController.getFinance);
financeRouter.post("/:gameId/finance/seats", authorizeMiddleware(), financeController.syncSeats);
financeRouter.post("/:gameId/finance/entries", authorizeMiddleware(), financeController.createEntry);
financeRouter.post("/:gameId/finance/knockouts", authorizeMiddleware(), financeController.createKnockout);
financeRouter.post("/:gameId/finance/ops/:financeOpId/void", authorizeMiddleware(), financeController.voidOp);
financeRouter.post("/:gameId/finance/ops/:financeOpId/correct", authorizeMiddleware(), financeController.correctOp);

export default financeRouter;
