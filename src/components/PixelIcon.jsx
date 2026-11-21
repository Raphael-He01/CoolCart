import cart from '../assets/pixel/cart.svg'
import headphones from '../assets/pixel/headphones.svg'
import coins from '../assets/pixel/coins.svg'

const icons = { cart, headphones, coins }

export default function PixelIcon({ name, className = '' }) {
  return <img className={'pixel-icon ' + className} src={icons[name]} alt="" aria-hidden="true" />
}
