import { Router, type IRouter } from "express";
import healthRouter from "./health";
import proxyRouter from "./proxy";
import cctvRouter from "./cctv";

const router: IRouter = Router();

router.use(healthRouter);
router.use(proxyRouter);
router.use(cctvRouter);

export default router;
