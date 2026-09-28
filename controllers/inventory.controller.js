import {
  adjustInventory,
  getInventoryProduct,
  listInventoryMovements,
  listInventoryProducts,
  receiveInventory,
  returnInventory,
} from "../services/inventory.service.js";

export async function getInventoryList(req, res, next) {
  try {
    const inventory = await listInventoryProducts(req.validated?.query ?? {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, inventory });
  } catch (error) {
    return next(error);
  }
}

export async function getInventoryItem(req, res, next) {
  try {
    const inventory = await getInventoryProduct(req.validated.params.productId);

    if (!inventory) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "PRODUCT_NOT_FOUND",
          message: "Товар не найден.",
        },
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, inventory });
  } catch (error) {
    return next(error);
  }
}

export async function postInventoryReceipt(req, res, next) {
  try {
    const inventory = await receiveInventory({
      productId: req.validated.params.productId,
      actorId: req.user.id,
      quantity: req.validated.body.quantity,
      reason: req.validated.body.reason,
    });

    return res.status(200).json({ ok: true, inventory });
  } catch (error) {
    return next(error);
  }
}

export async function postInventoryReturn(req, res, next) {
  try {
    const inventory = await returnInventory({
      productId: req.validated.params.productId,
      actorId: req.user.id,
      quantity: req.validated.body.quantity,
      reason: req.validated.body.reason,
    });

    return res.status(200).json({ ok: true, inventory });
  } catch (error) {
    return next(error);
  }
}

export async function patchInventoryStock(req, res, next) {
  try {
    const inventory = await adjustInventory({
      productId: req.validated.params.productId,
      actorId: req.user.id,
      stockQuantity: req.validated.body.stockQuantity,
      reason: req.validated.body.reason,
    });

    return res.status(200).json({ ok: true, inventory });
  } catch (error) {
    return next(error);
  }
}

export async function getInventoryMovements(req, res, next) {
  try {
    const movements = await listInventoryMovements(req.validated?.query ?? {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, movements });
  } catch (error) {
    return next(error);
  }
}
