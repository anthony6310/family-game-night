import { useState } from 'react';
import { getGame, type GameId, type RoomState } from '@fgn/shared';
import { GameCarousel, RandomArt } from '../GameCarousel';

/** The first sentence of a game's description: the one-line summary shown on the hub. */
export const oneLine = (description: string) => description.split(/(?<=[.!?])\s/)[0];

/**
 * The picked game, big, at the heart of the hub. The HOST sees it as a button that opens the Game menu to change it; everyone else sees the looping carousel (it slides to whatever the
 * host picks). Under it, a one-line summary and a "How to play" toggle with the full description.
 */
export function GameHero({ room, isHost, images, onChange }: { room: RoomState; isHost: boolean; images: Partial<Record<GameId, string>>; onChange: () => void }) {
  const [more, setMore] = useState(false);
  const game = getGame(room.settings.gameId);
  const random = room.settings.random && !game;
  return (
    <section className="game-hero" aria-label="The game">
      {isHost ? (
        <button className="game-tile selected game-hero-tile" onClick={onChange} aria-label={`${game?.name ?? 'Random game'}: tap to change the game`}>
          {game ? <span className="game-art">{images[game.id as GameId] && <img src={images[game.id as GameId]} alt="" draggable={false} />}</span> : random ? <RandomArt /> : <span className="game-art" />}
          <span className="game-name">{game ? game.name : random ? 'Random' : 'Pick a game'} <span className="muted">· change</span></span>
        </button>
      ) : (
        <>
          <GameCarousel selectedId={room.settings.gameId} random={room.settings.random} images={images} />
          <p className="game-hero-name">{random ? 'A random game' : game ? game.name : 'Waiting for the host to pick a game'}</p>
        </>
      )}
      {random && <p className="muted game-hero-line">Chosen at random once everyone is ready: you will all watch the roulette pick it.</p>}
      {game && (
        <>
          <p className="muted game-hero-line">{more ? game.description : oneLine(game.description)}</p>
          {game.description !== oneLine(game.description) && <button className="link" onClick={() => setMore(!more)}>{more ? 'Show less' : 'How to play'}</button>}
        </>
      )}
    </section>
  );
}
