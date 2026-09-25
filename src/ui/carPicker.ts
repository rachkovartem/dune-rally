// src/ui/carPicker.ts
import { isCarId, type CarId } from '../vehicle/cars';
import { CAR_LABELS } from './carChoice';

export interface CarPicker {
  selected(): CarId;
  /**
   * Hides the option of a car that cannot be driven here. When it was the selected one,
   * `replacement` is selected instead and onChange hears about it like a click.
   */
  withdraw(carId: CarId, replacement: CarId): void;
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
  const optionOf = (carId: CarId): HTMLElement => {
    const found = options.find((option) => carIdOf(option) === carId);
    if (!found) throw new Error(`Car picker: there is no option for the "${carId}" car`);
    return found;
  };
  optionOf(initial);
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

  return {
    selected: () => selected,
    withdraw(carId, replacement) {
      if (replacement === carId) throw new Error(`Car picker: the "${carId}" car cannot replace itself`);
      const replacementOption = optionOf(replacement);
      if (replacementOption.hidden) throw new Error(`Car picker: the replacement "${replacement}" car is withdrawn too`);
      optionOf(carId).hidden = true;
      if (selected !== carId) return;
      selected = replacement;
      show();
      onChange(replacement);
    },
  };
}
