import { useEffect, useMemo, useState } from 'react';
import { CREATURE_SPACE, type CreatureKind } from '@fgn/shared';
import { getHeadIcons } from './penguin/headIcons';

interface Props {
  /** What is in the bag, in the order it was caught. */
  bag: CreatureKind[];
  /** How many spaces the bag has (one circle each). */
  capacity: number;
  /** Goes up by one each time a loop closed round animals that did NOT fit: the circles flash red and shake. */
  flash: number;
}

const FLASH_MS = 700;

/**
 * The bag, on the screen: one circle for each space it holds, side by side. An animal's circle shows its face (drawn from the
 * same 3D heads the game uses); an animal that takes more than one space (a polar bear takes three) shows its face in EACH of its
 * circles, so you can see it uses 3 spaces. Empty spaces are plain outlines. When a loop
 * catches more than will fit, the circles flash red and shake a little as the feedback.
 */
export function BagMeter({ bag, capacity, flash }: Props) {
  const icons = useMemo(() => getHeadIcons(), []);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (flash === 0) return;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  // One entry per circle: a face (an animal's face fills every space it takes), or empty.
  const cells: ({ type: 'face'; kind: CreatureKind } | { type: 'empty' })[] = [];
  for (const kind of bag) for (let space = 0; space < CREATURE_SPACE[kind]; space++) cells.push({ type: 'face', kind });
  while (cells.length < capacity) cells.push({ type: 'empty' });
  const used = bag.reduce((n, kind) => n + CREATURE_SPACE[kind], 0);

  return (
    <div className={flashing ? 'bag-meter flashing' : 'bag-meter'} role="img" aria-label={`Bag: ${used} of ${capacity} spaces used`}>
      {cells.slice(0, capacity).map((cell, i) => (
        <span key={i} className={`bag-cell ${cell.type}`}>
          {cell.type === 'face' && <img src={icons[cell.kind]} alt="" draggable={false} />}
        </span>
      ))}
    </div>
  );
}
