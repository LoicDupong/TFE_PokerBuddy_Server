import { Router } from "express";
import helloWorldController from "../controllers/hello-world.controller.js";

const helloWorldRouter = Router();

helloWorldRouter.route('/hello-world')
    .get(helloWorldController.message);

export default helloWorldRouter;