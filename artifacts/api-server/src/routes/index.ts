import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import systemRouter from "./system";
import usersRouter from "./users";
import productsRouter from "./products";
import entitiesRouter from "./entities";
import invoicesRouter from "./invoices";
import purchasesRouter from "./purchases";
import paymentsRouter from "./payments";
import rewardsRouter from "./rewards";
import manufacturingRouter from "./manufacturing";
import dashboardRouter from "./dashboard";
import accountsRouter from "./accounts";
import workersRouter from "./workers";
import expensesRouter from "./expenses";
import customerOrdersRouter from "./customer-orders";
import reportsRouter from "./reports";
import subscriptionsRouter from "./subscriptions";
import settingsRouter from "./settings";
import gstinRouter from "./gstin";
import systemAdminRouter from "./system-admin";
import { requireAuth } from "../lib/tenant";

const router: IRouter = Router();

// Public routes (no session required).
router.use(healthRouter);
router.use(systemRouter);
router.use(authRouter);

// Everything below requires an authenticated session. This is the single choke
// point that guarantees no data route can be reached anonymously, and exposes
// req.companyId / req.isSuperAdmin to downstream handlers.
router.use(requireAuth);

router.use(usersRouter);
router.use(productsRouter);
router.use(entitiesRouter);
router.use(invoicesRouter);
router.use(purchasesRouter);
router.use(paymentsRouter);
router.use(rewardsRouter);
router.use(manufacturingRouter);
router.use(dashboardRouter);
router.use(accountsRouter);
router.use(workersRouter);
router.use(expensesRouter);
router.use(customerOrdersRouter);
router.use(reportsRouter);
// settings + gstin are mounted BEFORE subscriptions: the subscriptions router
// installs a path-less super_admin guard, so anything mounted after it would be
// 403'd for company-scoped users. Print/app settings must be readable by every
// authenticated role (e.g. salesmen printing invoices).
router.use(settingsRouter);
router.use(gstinRouter);
// Mounted before subscriptions: the subscriptions router installs a path-less
// super_admin guard, so anything after it is 403'd for company admins. These
// backup routes are company-admin-only and must stay reachable.
router.use(systemAdminRouter);
router.use(subscriptionsRouter);

export default router;
