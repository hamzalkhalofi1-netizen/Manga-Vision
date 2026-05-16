import { Router, type IRouter } from "express";
import healthRouter from "./health";
import translateRouter from "./translate";
import translateImageRouter from "./translate-image";
import mangaProxyRouter from "./manga-proxy";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/translate", translateRouter);
router.use("/translate-image", translateImageRouter);
router.use("/manga-proxy", mangaProxyRouter);

export default router;
