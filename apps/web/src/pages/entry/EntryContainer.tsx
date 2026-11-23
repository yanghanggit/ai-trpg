import { useNavigate } from "react-router";
import { describeApiError } from "../../api/describeApiError";
import { readGameFacts } from "../../features/games/gameState";
import { useContentPacks } from "../../features/games/useContentPacks";
import { useCreateGame } from "../../features/games/useCreateGame";
import { useMe } from "../../features/identity/useMe";
import EntryPage from "./EntryPage";
import type { CreateGameRequest, EntryPageData } from "./types";

/** 取数、建局与跳转都在这里；`EntryPage` 只负责渲染。 */
export default function EntryContainer() {
  const navigate = useNavigate();
  const me = useMe();
  const packs = useContentPacks();
  const createGame = useCreateGame();

  const data: EntryPageData = {
    identity:
      me.data === undefined
        ? undefined
        : { username: me.data.username, displayName: me.data.displayName },
    packs: packs.data,
    packsError: packs.isError ? describeApiError(packs.error) : undefined,
  };

  async function handleCreate(input: CreateGameRequest) {
    const state = await createGame.mutateAsync(input);
    const slug = readGameFacts(state).slug;
    if (slug !== undefined) {
      navigate(`/g/${encodeURIComponent(slug)}`);
    }
    return slug;
  }

  return <EntryPage data={data} onCreate={handleCreate} />;
}
