import {
  addFavorite,
  clearFavorites,
  getFavorites,
  removeFavorite,
} from "../services/favorite.service.js";
import { resolveCommerceOwner } from "../services/commerce.service.js";

export async function readFavorites(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const favorites = await getFavorites(owner);

    return res.status(200).json({
      ok: true,
      favorites,
    });
  } catch (error) {
    return next(error);
  }
}

export async function putFavorite(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res, {
      createGuest: true,
    });
    const favorites = await addFavorite(owner, req.validated.params.slug);

    return res.status(200).json({
      ok: true,
      favorites,
    });
  } catch (error) {
    return next(error);
  }
}

export async function deleteFavorite(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const favorites = await removeFavorite(owner, req.validated.params.slug);

    return res.status(200).json({
      ok: true,
      favorites,
    });
  } catch (error) {
    return next(error);
  }
}

export async function deleteFavorites(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const favorites = await clearFavorites(owner);

    return res.status(200).json({
      ok: true,
      favorites,
    });
  } catch (error) {
    return next(error);
  }
}
