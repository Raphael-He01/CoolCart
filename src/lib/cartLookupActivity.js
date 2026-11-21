import { createContext, useContext } from 'react'
import { sameCartLookupInput } from './cartProductLinks.js'

export const CartLookupActivity = createContext(new Map())

export function useCartLookupRunning(id, input) {
  const requests = useContext(CartLookupActivity)
  return sameCartLookupInput(input, requests.get(id))
}
