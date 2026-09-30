/** Global state layer. Import from `@/state` rather than deep paths. */
export { AuthProvider, useAuth, type AuthContextValue } from "./auth-provider";
export {
  CartProvider,
  useCart,
  type CartContextValue,
  type CartLine,
  type SelectedVariant,
} from "./cart-provider";
export { OutletProvider, useOutlet, type OutletContextValue } from "./outlet-provider";
