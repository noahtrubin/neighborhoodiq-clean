"use client";

import { useAuth } from "./lib/AuthProvider";
import Icon from "./components/Icon";

export default function FavoriteButton({ zip }: { zip: string }) {
  const { user, favorites, toggleFavorite } = useAuth();
  const fav = favorites.has(zip);

  return (
    <button
      className="niq-tab"
      data-active={fav}
      onClick={() => toggleFavorite(zip)}
      title={
        user
          ? fav
            ? "Remove from your favorites"
            : "Save to your favorites"
          : "Sign in to save favorites"
      }
    >
      <Icon name={fav ? "star-filled" : "star"} size={15} />
      {fav ? "Favorited" : "Favorite this ZIP"}
    </button>
  );
}
