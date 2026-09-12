import { createFileRoute } from "@tanstack/react-router"
import { FeedArticlePage } from "~/components/shipping/pages"

export const Route = createFileRoute("/feed_/$id")({ component: FeedArticleRoute })

function FeedArticleRoute() {
  return <FeedArticlePage id={Route.useParams().id} />
}
