import { useCallback, useEffect, useState } from "react";
import { fetchProgress } from "./api";
import BottomNav, { type Tab } from "./components/BottomNav";
import OnboardingScreen from "./screens/OnboardingScreen";
import PracticeScreen from "./screens/PracticeScreen";
import ProfileScreen from "./screens/ProfileScreen";
import RoadmapScreen from "./screens/RoadmapScreen";

const ONBOARDED_KEY = "reason_onboarded";

export default function App() {
  const [tab, setTab] = useState<Tab>("practice");
  const [requestedSlug, setRequestedSlug] = useState<string | null>(null);
  const [placementQueue, setPlacementQueue] = useState<string[]>([]);
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchProgress()
      .then((progress) => {
        const local = localStorage.getItem(ONBOARDED_KEY) === "1";
        setNeedsOnboarding(!(progress.onboarded || local));
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load");
        setNeedsOnboarding(false);
      });
  }, []);

  const consumeSlug = useCallback(() => {
    setRequestedSlug(null);
  }, []);

  const startPractice = useCallback((slug: string) => {
    setRequestedSlug(slug);
    setTab("practice");
  }, []);

  if (needsOnboarding === null) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (needsOnboarding) {
    return (
      <div className="app">
        <OnboardingScreen
          onDone={(slugs) => {
            localStorage.setItem(ONBOARDED_KEY, "1");
            setNeedsOnboarding(false);
            if (slugs && slugs.length > 0) {
              setPlacementQueue(slugs.slice(1));
              startPractice(slugs[0]);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <main className="app-main">
        <div className={tab === "roadmap" ? "screen-panel" : "screen-panel hidden"}>
          <RoadmapScreen active={tab === "roadmap"} onPractice={startPractice} />
        </div>
        <div className={tab === "practice" ? "screen-panel" : "screen-panel hidden"}>
          <PracticeScreen
            requestedSlug={requestedSlug}
            queuedSlugs={placementQueue}
            onOpenRoadmap={() => setTab("roadmap")}
            onConsumedSlug={consumeSlug}
            onShiftQueue={() => setPlacementQueue((queue) => queue.slice(1))}
          />
        </div>
        <div className={tab === "profile" ? "screen-panel" : "screen-panel hidden"}>
          <ProfileScreen />
        </div>
      </main>
      {error && <p className="error">{error}</p>}
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  );
}
