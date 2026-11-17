// Android · Chrome : lien → ⋮ → Ajouter à l'écran d'accueil → Installer → icône → app plein écran.
import React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ChromeAndroid, CHROME_CONTENT, CHROME_TARGETS } from '../browsers/ChromeAndroid'
import { OneUIHome, ONEUI_HOME_TARGETS } from '../homescreens/OneUIHome'
import { AppSplash, HubScreen, WebPageLanding } from '../app-screens'
import { TapIndicator } from '../ui/TapIndicator'
import { Sfx } from '../audio'
import { C } from '../theme'
import { APP_URL, SEQ } from '../timeline'
import { POSE, SPRING, easeIn, easeOut, fingerAt, glide, mixPose, motionBlur, pressPulse, ramp, sp, typed, type Pose, type Tap } from '../motion'
import { PhoneRig, Fill } from './PhoneRig'
import { PlatformBadge, StepCaption, StepProgress, type Step } from './Caption'
import { IOS_HUB_AT } from './IosTutorial'

const DUR = SEQ.android.duration

export const AND = {
  typeFrom: 44,
  perChar: 2.5,
  loaded: 104,
  tMenu: 146,
  tAddItem: 190,
  tInstall: 250,
  installing: [262, 338] as const,
  homeIn: [340, 364] as const,
  iconIn: 364,
  tIcon: 398,
  launch: [406, 442] as const,
  splashSwitch: 56,
  out: DUR - 34,
}
export const ANDROID_HUB_AT = AND.launch[0] + AND.splashSwitch

const STEPS: Step[] = [
  { from: 0, text: 'Ouvre le lien dans Chrome' },
  { from: 124, text: 'Touche ⋮' },
  { from: 162, text: "Ajouter à l'écran d'accueil" },
  { from: 222, text: 'Installer ✓' },
]

const TAPS: Tap[] = [
  { at: AND.tMenu, pt: CHROME_TARGETS.menuButton },
  { at: AND.tAddItem, pt: CHROME_TARGETS.addToHomeItem },
  { at: AND.tInstall, pt: CHROME_TARGETS.installButton },
  { at: AND.tIcon, pt: ONEUI_HOME_TARGETS.appIcon },
]

const IPHONE_EXIT: Pose = { x: -720, y: 1040, s: 1.25, rx: 4, ry: 32, rz: -7 }
const GALAXY_ENTER: Pose = { x: 1780, y: 1040, s: 1.3, rx: 4, ry: -32, rz: 7 }
const slide = (f: number) => glide(f, 0, { stiffness: 75, damping: 18 })
export const androidGalaxyPose = (f: number): Pose => mixPose(GALAXY_ENTER, POSE.tutoGalaxy, slide(f))
const iphonePose = (f: number): Pose => mixPose(POSE.tutoIphone, IPHONE_EXIT, slide(f))

export const AndroidTutorial: React.FC = () => {
  const f = useCurrentFrame()

  const typing = f < AND.loaded
  const menuOpen = ramp(f, AND.tMenu + 2, AND.tMenu + 14) * (1 - ramp(f, AND.tAddItem + 4, AND.tAddItem + 12))
  const installDialog = ramp(f, AND.tAddItem + 8, AND.tAddItem + 28) * (1 - ramp(f, AND.tInstall + 6, AND.tInstall + 16))
  const installing = f >= AND.installing[0] ? ramp(f, AND.installing[0], AND.installing[1]) : undefined
  const doneAt = Math.round(AND.installing[0] + 0.55 * (AND.installing[1] - AND.installing[0]))
  const home = ramp(f, AND.homeIn[0], AND.homeIn[1])
  const iconAppear = sp(f, AND.iconIn, SPRING.bouncy)
  const iconPress = pressPulse(f, AND.tIcon)
  const launch = ramp(f, AND.launch[0], AND.launch[1])
  const finger = fingerAt(f, TAPS)

  const page = <WebPageLanding t={Math.max(0, f - AND.loaded)} width={CHROME_CONTENT.w} height={CHROME_CONTENT.h} safeTop={16} />
  const blank = <div style={{ width: CHROME_CONTENT.w, height: CHROME_CONTENT.h, background: '#fff' }} />

  return (
    <AbsoluteFill>
      {f < 60 && (
        <PhoneRig device="iphone" pose={iphonePose(f)} blur={motionBlur(iphonePose, f)}>
          <HubScreen t={DUR - IOS_HUB_AT + f} width={440} height={956} safeTop={58} />
        </PhoneRig>
      )}

      <PhoneRig device="galaxy" pose={androidGalaxyPose(f)} blur={motionBlur(androidGalaxyPose, f)} statusBar={home > 0.5 && launch < 0.5 ? 'light' : 'dark'}>
        {home > 0 && (
          <Fill style={{ transform: `scale(${1.1 - 0.1 * easeOut(home)})` }}>
            <OneUIHome
              iconAppear={iconAppear}
              iconPress={iconPress}
              launch={launch}
              appContent={<AppSplash t={Math.max(0, f - AND.launch[0])} width={412} height={915} safeTop={40} switchAt={AND.splashSwitch} />}
            />
          </Fill>
        )}
        {home < 1 && (
          <Fill style={{ opacity: 1 - ramp(home, 0.45, 1), transform: `translateY(${-easeIn(home) * 300}px) scale(${1 - 0.6 * easeOut(home)})`, borderRadius: 30, overflow: 'hidden', boxShadow: home > 0 ? '0 20px 60px rgba(0,0,0,0.35)' : undefined }}>
            <ChromeAndroid
              content={typing ? blank : page}
              url={APP_URL}
              typedUrl={typing ? typed(f, APP_URL, AND.typeFrom, AND.perChar) : undefined}
              caretVisible={Math.floor(f / 16) % 2 === 0}
              menuOpen={menuOpen}
              highlight={f >= AND.tAddItem - 1 ? "Ajouter à l'écran d'accueil" : undefined}
              installDialog={installDialog}
              installPressed={f >= AND.tInstall && f < AND.tInstall + 12}
              installingProgress={installing}
            />
          </Fill>
        )}
        <TapIndicator x={finger.x} y={finger.y} visible={finger.visible} press={finger.press} />
      </PhoneRig>

      <PlatformBadge f={f} label="Android • Chrome" color={C.mint} at={14} out={AND.out} />
      <StepCaption f={f} steps={STEPS} accent={C.mint} top={150} out={AND.out} />
      <StepProgress f={f} steps={STEPS} doneAt={AND.launch[1]} accent={C.mint} top={1752} at={26} out={AND.out} />

      <Sfx name="whoosh" at={0} volume={0.6} />
      {Array.from({ length: APP_URL.length }, (_, i) => (
        <Sfx key={`t${i}`} name="type" at={AND.typeFrom + Math.round(i * AND.perChar)} volume={0.3} />
      ))}
      <Sfx name="pop" at={AND.loaded} volume={0.3} />
      {TAPS.map((t) => <Sfx key={t.at} name="tap" at={t.at} volume={0.5} />)}
      <Sfx name="swoosh-up" at={AND.tAddItem + 8} volume={0.55} />
      <Sfx name="pop" at={doneAt} volume={0.45} />
      <Sfx name="whoosh" at={AND.homeIn[0]} volume={0.35} />
      <Sfx name="pop" at={AND.iconIn + 2} volume={0.6} />
      <Sfx name="whoosh" at={AND.launch[0]} volume={0.45} />
      <Sfx name="success" at={ANDROID_HUB_AT + 2} volume={0.7} />
    </AbsoluteFill>
  )
}
