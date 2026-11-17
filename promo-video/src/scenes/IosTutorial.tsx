// iOS · Safari : lien → ⋯ → Partager → Sur l'écran d'accueil → Ajouter → icône → app plein écran.
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { SafariIOS26, SAFARI_TARGETS, addToHomeItemAt } from '../browsers/SafariIOS26'
import { IOSHome, IOS_HOME_TARGETS } from '../homescreens/IOSHome'
import { AppSplash, HubScreen, LeaderboardScreen, WebPageLanding } from '../app-screens'
import { TapIndicator } from '../ui/TapIndicator'
import { Sfx } from '../audio'
import { C } from '../theme'
import { APP_URL, SEQ } from '../timeline'
import { POSE, SPRING, easeIn, easeOut, fingerAt, glide, mixPose, motionBlur, pressPulse, ramp, sp, typed, type Pose, type Tap } from '../motion'
import { PhoneRig, Fill } from './PhoneRig'
import { PlatformBadge, StepCaption, StepProgress, type Step } from './Caption'

const DUR = SEQ.ios.duration

// Repères (frames locales)
export const IOS = {
  typeFrom: 44,
  perChar: 2.5,
  loaded: 104,
  tMore: 148,
  tShare: 182,
  scroll: [222, 248] as const,
  tHome: 268,
  tAdd: 320,
  homeIn: [328, 352] as const,
  iconIn: 352,
  tIcon: 386,
  launch: [394, 430] as const,
  splashSwitch: 56,
  out: DUR - 34,
}
/** Frame locale à laquelle le Hub apparaît en plein écran. */
export const IOS_HUB_AT = IOS.launch[0] + IOS.splashSwitch

const STEPS: Step[] = [
  { from: 0, text: 'Ouvre le lien dans Safari' },
  { from: 126, text: 'Touche ⋯ puis Partager' },
  { from: 214, text: "Sur l'écran d'accueil" },
  { from: 298, text: 'Ajouter ✓' },
]

const TAPS: Tap[] = [
  { at: IOS.tMore, pt: SAFARI_TARGETS.moreButton },
  { at: IOS.tShare, pt: SAFARI_TARGETS.shareItem },
  { at: IOS.tHome, pt: addToHomeItemAt(1) },
  { at: IOS.tAdd, pt: SAFARI_TARGETS.addButton },
  { at: IOS.tIcon, pt: IOS_HOME_TARGETS.appIcon },
]

const IPHONE_EXIT_GALAXY: Pose = { x: 1750, y: 1150, s: 1.05, rx: 6, ry: -40, rz: 10 }

export const iosIphonePose = (f: number): Pose => mixPose(POSE.introIphone, POSE.tutoIphone, glide(f, 0, { stiffness: 80, damping: 19 }))
const galaxyPose = (f: number): Pose => mixPose(POSE.introGalaxy, IPHONE_EXIT_GALAXY, easeIn(ramp(f, 0, 30)))

export const IosTutorial: React.FC = () => {
  const f = useCurrentFrame()

  const typing = f < IOS.loaded
  const menuOpen = ramp(f, IOS.tMore + 2, IOS.tMore + 14) * (1 - ramp(f, IOS.tShare + 4, IOS.tShare + 12))
  const shareSheet = ramp(f, IOS.tShare + 8, IOS.tShare + 30)
  const shareScroll = ramp(f, IOS.scroll[0], IOS.scroll[1])
  const addSheet = ramp(f, IOS.tHome + 6, IOS.tHome + 30)
  const highlight =
    f >= IOS.tAdd - 1 ? 'Ajouter' : f >= IOS.tHome - 1 ? "Sur l'écran d'accueil" : f >= IOS.tShare - 1 ? 'Partager' : undefined
  const home = ramp(f, IOS.homeIn[0], IOS.homeIn[1])
  const iconAppear = sp(f, IOS.iconIn, SPRING.bouncy)
  const iconPress = pressPulse(f, IOS.tIcon)
  const launch = ramp(f, IOS.launch[0], IOS.launch[1])
  const finger = fingerAt(f, TAPS)
  const fromHub = 1 - ramp(f, 8, 30)

  const page = <WebPageLanding t={Math.max(0, f - IOS.loaded)} width={440} height={956} safeTop={58} />
  const blank = <div style={{ width: 440, height: 956, background: '#fff' }} />

  return (
    <AbsoluteFill>
      {/* le Galaxy sort par la droite */}
      {f < 32 && (
        <PhoneRig device="galaxy" pose={galaxyPose(f)} blur={motionBlur(galaxyPose, f)}>
          <LeaderboardScreen t={90 + f} width={412} height={915} safeTop={40} />
        </PhoneRig>
      )}

      <PhoneRig device="iphone" pose={iosIphonePose(f)} blur={motionBlur(iosIphonePose, f)} statusBar={home > 0.5 && launch < 0.5 ? 'light' : 'dark'}>
        {home > 0 && (
          <Fill style={{ transform: `scale(${1.1 - 0.1 * easeOut(home)})` }}>
            <IOSHome
              iconAppear={iconAppear}
              iconPress={iconPress}
              launch={launch}
              appContent={<AppSplash t={Math.max(0, f - IOS.launch[0])} width={440} height={956} safeTop={58} switchAt={IOS.splashSwitch} />}
            />
          </Fill>
        )}
        {home < 1 && (
          <Fill style={{ opacity: 1 - ramp(home, 0.45, 1), transform: `translateY(${-easeIn(home) * 300}px) scale(${1 - 0.6 * easeOut(home)})`, borderRadius: 60, overflow: 'hidden', boxShadow: home > 0 ? '0 20px 60px rgba(0,0,0,0.35)' : undefined }}>
            <SafariIOS26
              content={typing ? blank : page}
              url={APP_URL}
              typedUrl={typing ? typed(f, APP_URL, IOS.typeFrom, IOS.perChar) : undefined}
              caretVisible={Math.floor(f / 16) % 2 === 0}
              menuOpen={menuOpen}
              highlight={highlight}
              shareSheet={shareSheet}
              shareScroll={shareScroll}
              addSheet={addSheet}
            />
          </Fill>
        )}
        {fromHub > 0 && (
          <Fill style={{ opacity: fromHub }}>
            <HubScreen t={90 + f} width={440} height={956} safeTop={58} />
          </Fill>
        )}
        <TapIndicator x={finger.x} y={finger.y} visible={finger.visible} press={finger.press} />
      </PhoneRig>

      <PlatformBadge f={f} label="iOS • Safari" color={C.sky} at={10} out={IOS.out} />
      <StepCaption f={f} steps={STEPS} accent={C.sky} top={150} out={IOS.out} />
      <StepProgress f={f} steps={STEPS} doneAt={IOS.launch[1]} accent={C.sky} top={1752} at={24} out={IOS.out} />

      {/* sons */}
      <Sfx name="whoosh" at={0} volume={0.6} />
      {Array.from({ length: APP_URL.length }, (_, i) => (
        <Sfx key={`t${i}`} name="type" at={IOS.typeFrom + Math.round(i * IOS.perChar)} volume={0.3} />
      ))}
      <Sfx name="pop" at={IOS.loaded} volume={0.3} />
      {TAPS.map((t) => <Sfx key={t.at} name="tap" at={t.at} volume={0.5} />)}
      <Sfx name="swoosh-up" at={IOS.tShare + 8} volume={0.55} />
      <Sfx name="swoosh-up" at={IOS.tHome + 6} volume={0.55} />
      <Sfx name="whoosh" at={IOS.homeIn[0]} volume={0.35} />
      <Sfx name="pop" at={IOS.iconIn + 2} volume={0.6} />
      <Sfx name="whoosh" at={IOS.launch[0]} volume={0.45} />
      <Sfx name="success" at={IOS_HUB_AT + 2} volume={0.7} />
    </AbsoluteFill>
  )
}

