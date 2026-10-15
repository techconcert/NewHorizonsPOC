/** Typed command union (docs/ARCHITECTURE.md section 5). All fields are integers. */

export type GameSpeed = 0 | 1 | 2 | 4;

/**
 * Dial fields are integer steps (not resource amounts); `speed` is an index into the speed table
 * (0 Economy, 1 Cruise, 2 Hard Burn); `hull` indexes the hull table; `target` is a planet index.
 */
export interface LaunchShipCommand {
  type: 'LaunchShip';
  colony: number;
  target: number;
  hull: number;
  passengers: number;
  supplies: number;
  fuel: number;
  speed: number;
  kit: number;
  security: number;
}

/** `ship` is the ship entity id; `target` a planet index (an own colony's planet unloads there). */
export interface RerouteShipCommand {
  type: 'RerouteShip';
  ship: number;
  target: number;
}

/**
 * `card` is the pending-card slot (0 is the oldest, the one the UI shows); `choice` the choice
 * index; `ship` the ship entity the card is about (snapshot META_PENDING_SHIP). A resolve whose
 * ship differs from the card's subject at that slot is refused, so a stale or duplicate resolve
 * can never answer another ship's card.
 */
export interface ResolveEventChoiceCommand {
  type: 'ResolveEventChoice';
  card: number;
  choice: number;
  ship: number;
}

/**
 * Land an expedition from an Arrived ship (D-065). `explorers` come from the ship's colonists,
 * `guards` from its security, `supplies` and `kit` from its manifest (all amounts, not dial
 * steps). `stance`: 0 Cautious, 1 Balanced, 2 Bold (fixed for the expedition).
 */
export interface FormExpeditionCommand {
  type: 'FormExpedition';
  ship: number;
  explorers: number;
  guards: number;
  supplies: number;
  kit: number;
  stance: number;
}

/**
 * Send the expedition to explore. `region` and `region2` are local region indices of the planet;
 * `region2` is -1 for one team, or another region to split into two teams (faster, riskier).
 */
export interface ExploreRegionCommand {
  type: 'ExploreRegion';
  expedition: number;
  region: number;
  region2: number;
}

/** Found a colony at an explored region (local index) and roll the founding. */
export interface FoundColonyCommand {
  type: 'FoundColony';
  expedition: number;
  region: number;
}

/** Take the expedition's survivors and cargo back aboard the ship in orbit. */
export interface ReEmbarkCommand {
  type: 'ReEmbark';
  expedition: number;
}

/** Colony stance toward the natives: 0 Coexist, 1 Defend, 2 Push out (D-095). `colony` is the colony entity id. */
export interface SetColonyStanceCommand {
  type: 'SetColonyStance';
  colony: number;
  stance: number;
}

/**
 * Start a district in an explored region (local index) of a colony. `district` is 1 Farm, 2 Mine,
 * 3 Refinery, 4 Habitat or 5 Research; the Spaceport has its own command. The Production cost is
 * paid at once and the district works after its build days (D-093).
 */
export interface BuildDistrictCommand {
  type: 'BuildDistrict';
  colony: number;
  region: number;
  district: number;
}

/** Start a Spaceport (a district) in an explored region; one per colony (D-093). */
export interface BuildSpaceportCommand {
  type: 'BuildSpaceport';
  colony: number;
  region: number;
}

/** Choose the tech to research next (an index into src/data/techs.json); switching restarts its points (D-092). */
export interface ChooseTechCommand {
  type: 'ChooseTech';
  tech: number;
}

export type Command =
  | LaunchShipCommand
  | RerouteShipCommand
  | FormExpeditionCommand
  | ExploreRegionCommand
  | FoundColonyCommand
  | ReEmbarkCommand
  | SetColonyStanceCommand
  | BuildDistrictCommand
  | BuildSpaceportCommand
  | ChooseTechCommand
  | { type: 'SetGameSpeed'; speed: GameSpeed }
  | ResolveEventChoiceCommand;

export type CommandType = Command['type'];

export const COMMAND_TYPES: readonly CommandType[] = [
  'LaunchShip',
  'RerouteShip',
  'FormExpedition',
  'ExploreRegion',
  'FoundColony',
  'ReEmbark',
  'SetColonyStance',
  'BuildDistrict',
  'BuildSpaceport',
  'ChooseTech',
  'SetGameSpeed',
  'ResolveEventChoice',
];

/** Why a LaunchShip command was rejected (checked in this order by the sim; see D-041). */
export type LaunchRejectReason =
  | 'NO_SUCH_COLONY'
  | 'NO_SPACEPORT'
  | 'INVALID_TARGET'
  | 'INVALID_HULL'
  | 'INVALID_SPEED_SETTING'
  | 'INVALID_LOADOUT'
  | 'OVER_CAPACITY'
  | 'NO_PASSENGERS'
  | 'OUT_OF_RANGE'
  | 'INSUFFICIENT_PASSENGERS'
  | 'INSUFFICIENT_SUPPLIES'
  | 'INSUFFICIENT_FUEL'
  | 'INSUFFICIENT_PRODUCTION'
  | 'SHIP_LIMIT'
  | 'ENTITY_LIMIT';

/** Why a RerouteShip command was rejected (checked in this order by the sim; D-052). */
export type RerouteRejectReason =
  | 'NO_SUCH_SHIP'
  | 'SHIP_LOST'
  | 'SHIP_DRIFTING'
  | 'EVENT_PENDING'
  | 'SHIP_NOT_IN_TRANSIT'
  | 'EXPEDITION_ACTIVE'
  | 'INVALID_TARGET'
  | 'SAME_TARGET'
  | 'OUT_OF_RANGE';

/**
 * Why a planetfall command was rejected (FormExpedition, ExploreRegion, FoundColony, ReEmbark),
 * in the order the sim checks them; D-066. A ship's NO_SUCH_SHIP / SHIP_LOST, INSUFFICIENT_SUPPLIES,
 * ENTITY_LIMIT and EVENT_PENDING are shared with the other commands.
 */
export type PlanetfallRejectReason =
  | 'NO_SUCH_SHIP'
  | 'SHIP_LOST'
  | 'SHIP_NOT_ARRIVED'
  | 'PLANET_OWNED'
  | 'EXPEDITION_EXISTS'
  | 'EXPEDITION_LIMIT'
  | 'INVALID_STANCE'
  | 'INVALID_EXPEDITION'
  | 'NO_EXPLORERS'
  | 'INSUFFICIENT_COLONISTS'
  | 'INSUFFICIENT_SECURITY'
  | 'INSUFFICIENT_KIT'
  | 'INSUFFICIENT_SUPPLIES'
  | 'ENTITY_LIMIT'
  | 'NO_SUCH_EXPEDITION'
  | 'EXPEDITION_NOT_ACTIVE'
  | 'EVENT_PENDING'
  | 'ROUND_IN_PROGRESS'
  | 'INVALID_REGION'
  | 'ALREADY_EXPLORED'
  | 'NOT_ADJACENT'
  | 'INVALID_SPLIT'
  | 'REGION_NOT_EXPLORED';

/**
 * Why a colony command (SetColonyStance, BuildDistrict, BuildSpaceport) or ChooseTech was
 * rejected, in the order the sim checks them (D-093). INSUFFICIENT_PRODUCTION is shared with launches.
 */
export type ColonyRejectReason =
  | 'NO_SUCH_COLONY'
  | 'INVALID_STANCE'
  | 'INVALID_DISTRICT'
  | 'SPACEPORT_EXISTS'
  | 'INVALID_REGION'
  | 'REGION_NOT_EXPLORED'
  | 'DISTRICT_EXISTS'
  | 'NATIVE_REGION'
  | 'INSUFFICIENT_PRODUCTION'
  | 'INVALID_TECH'
  | 'TECH_KNOWN'
  | 'TECH_LOCKED';

/** Why a ResolveEventChoice command was rejected. */
export type EventRejectReason = 'NO_PENDING_EVENT' | 'INVALID_CHOICE';

export type RejectReason =
  | 'UNKNOWN_COMMAND'
  | 'INVALID_SHAPE'
  | 'INVALID_SPEED'
  | 'NOT_IMPLEMENTED_YET'
  | 'QUEUE_FULL'
  | 'LOG_FULL'
  | LaunchRejectReason
  | RerouteRejectReason
  | PlanetfallRejectReason
  | ColonyRejectReason
  | EventRejectReason
  /** The run is over (won or lost): no command is accepted until a new game starts. */
  | 'GAME_ENDED';

export type CommandResult = { ok: true } | { ok: false; reason: RejectReason };
