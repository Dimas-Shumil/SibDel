import {
  addCartItem,
  clearCart,
  getCart,
  removeCartItem,
  setCartItemQuantity,
} from "../services/cart.service.js";
import { resolveCommerceOwner } from "../services/commerce.service.js";

export async function readCart(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const cart = await getCart(owner);

    return res.status(200).json({
      ok: true,
      cart,
    });
  } catch (error) {
    return next(error);
  }
}

export async function addItem(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res, {
      createGuest: true,
    });
    const cart = await addCartItem(owner, req.validated.body);

    return res.status(200).json({
      ok: true,
      cart,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateItemQuantity(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res, {
      createGuest: true,
    });
    const cart = await setCartItemQuantity(owner, {
      slug: req.validated.params.slug,
      quantity: req.validated.body.quantity,
    });

    return res.status(200).json({
      ok: true,
      cart,
    });
  } catch (error) {
    return next(error);
  }
}

export async function deleteItem(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const cart = await removeCartItem(owner, req.validated.params.slug);

    return res.status(200).json({
      ok: true,
      cart,
    });
  } catch (error) {
    return next(error);
  }
}

export async function deleteCart(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const cart = await clearCart(owner);

    return res.status(200).json({
      ok: true,
      cart,
    });
  } catch (error) {
    return next(error);
  }
}
