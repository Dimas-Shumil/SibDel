import { logger } from "../lib/logger.js";
import { getCart } from "../services/cart.service.js";
import { getFavorites } from "../services/favorite.service.js";
import {
  clearGuestCommerceCookie,
  mergeGuestCommerceIntoUser,
  readGuestCommerceToken,
  resolveCommerceOwner,
} from "../services/commerce.service.js";

export async function getCommerceState(req, res, next) {
  try {
    if (req.user?.id) {
      const guestToken = readGuestCommerceToken(req);

      if (guestToken) {
        try {
          await mergeGuestCommerceIntoUser({
            token: guestToken,
            userId: req.user.id,
          });
          clearGuestCommerceCookie(res);
        } catch (error) {
          logger.warn(
            {
              err: error,
              userId: req.user.id,
            },
            "Guest commerce state merge failed",
          );
        }
      }
    }

    const owner = resolveCommerceOwner(req, res);
    const [cart, favorites] = await Promise.all([
      getCart(owner),
      getFavorites(owner),
    ]);

    return res.status(200).json({
      ok: true,
      authenticated: Boolean(req.user?.id),
      cart,
      favorites,
    });
  } catch (error) {
    return next(error);
  }
}
