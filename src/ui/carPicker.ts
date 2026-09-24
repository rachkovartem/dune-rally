// src/ui/carPicker.ts
import { isCarId, type CarId } from '../vehicle/cars';
import { CAR_LABELS } from './carChoice';

export interface CarPicker {
  selected(): CarId;
}

const OPTION_SELECTOR = '.car-option';
const SELECTED_CLASS = 'is-selected';

function carIdOf(option: HTMLElement): CarId {
  const carId = option.dataset.carId;
  if (!isCarId(carId)) throw new Error(`Car picker: the option has an unknown data-car-id "${carId}"`);
  return carId;
}

/** Wires the `.car-option` buttons inside `root`; exactly one of them is selected at any time. */
export function createCarPicker(root: HTMLElement, initial: CarId, onChange: (carId: CarId) => void): CarPicker {
  const options = [...root.querySelectorAll<HTMLElement>(OPTION_SELECTOR)];
  if (!options.some((option) => carIdOf(option) === initial)) {
    throw new Error(`Car picker: there is no option for the "${initial}" car`);
  }
  let selected = initial;

  const show = (): void => {
    for (const option of options) {
      const isSelected = carIdOf(option) === selected;
      option.classList.toggle(SELECTED_CLASS, isSelected);
      option.setAttribute('aria-pressed', String(isSelected));
    }
  };

  for (const option of options) {
    const carId = carIdOf(option);
    option.textContent = CAR_LABELS[carId];
    option.addEventListener('click', (event) => {
      // The whole start overlay starts the game on click; choosing a car must not.
      event.stopPropagation();
      if (carId === selected) return;
      selected = carId;
      show();
      onChange(carId);
    });
  }
  show();

  return { selected: () => selected };
}
