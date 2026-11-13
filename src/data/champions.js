export const CHAMPION_ENGINES = {
  champion: { name: 'Champion V12', rating: 10 },
}

const nation = (name, short, colour, accent) => ({
  name,
  short,
  chassis: 10,
  engine: 'champion',
  colour,
  accent,
})

export const CHAMPION_TEAMS = {
  ita: nation('Italy', 'ITA', '#D40000', '#9E0000'),
  arg: nation('Argentina', 'ARG', '#F6F6F6', '#74ACDF'),
  gbr: nation('Great Britain', 'GBR', '#00502D', '#00341D'),
  aus: nation('Australia', 'AUS', '#00843D', '#FFCD00'),
  usa: nation('United States', 'USA', '#F6F6F6', '#0A3161'),
  nze: nation('New Zealand', 'NZE', '#141414', '#2A2A2A'),
  aut: nation('Austria', 'AUT', '#ED2939', '#FFFFFF'),
  bra: nation('Brazil', 'BRA', '#FFDF00', '#009C3B'),
  saf: nation('South Africa', 'SAF', '#007A4D', '#002395'),
  fin: nation('Finland', 'FIN', '#003580', '#FFFFFF'),
  fra: nation('France', 'FRA', '#0055A4', '#003D7A'),
  ger: nation('Germany', 'GER', '#F4F4F4', '#D8D8D8'),
  can: nation('Canada', 'CAN', '#00502D', '#FFFFFF'),
  spa: nation('Spain', 'SPA', '#FFC400', '#AA151B'),
  ned: nation('Netherlands', 'NED', '#FF6F00', '#E05A00'),
}

const champ = (number, name, code, team, star, helmet) => ({
  number,
  name,
  code,
  team,
  star,
  rating: 10,
  consistency: 'normal',
  aggression: 'normal',
  helmet,
})

export const CHAMPION_DRIVERS = [
  champ(1, 'Farina', 'FAR', 'ita', false, ['#F2F2F2', '#C62828']),
  champ(2, 'Ascari', 'ASC', 'ita', true, ['#1E5BC6', '#1E5BC6']),
  champ(3, 'Antonelli', 'ANT', 'ita', false, ['#FFD400', '#111111']),
  champ(4, 'Fangio', 'FAN', 'arg', true, ['#C8A165', '#6D4C2F']),
  champ(5, 'Hawthorn', 'HAW', 'gbr', false, ['#8D6E63', '#D7CCC8']),
  champ(6, 'G. Hill', 'GHI', 'gbr', true, ['#0D1B4C', '#FFFFFF']),
  champ(7, 'Clark', 'CLA', 'gbr', true, ['#4FA3E0', '#FFFFFF']),
  champ(8, 'Surtees', 'SUR', 'gbr', false, ['#1565C0', '#FFD400']),
  champ(9, 'Stewart', 'STE', 'gbr', true, ['#FFFFFF', '#C62828']),
  champ(10, 'Hunt', 'HUN', 'gbr', false, ['#111111', '#E53935']),
  champ(11, 'Mansell', 'MAN', 'gbr', false, ['#E53935', '#1565C0']),
  champ(12, 'D. Hill', 'DHI', 'gbr', false, ['#1A237E', '#4FC3F7']),
  champ(14, 'Hamilton', 'HAM', 'gbr', true, ['#FFD400', '#7B1FA2']),
  champ(15, 'Button', 'BUT', 'gbr', false, ['#F8F8F8', '#EC407A']),
  champ(16, 'Norris', 'NOR', 'gbr', false, ['#C6FF00', '#111111']),
  champ(17, 'Brabham', 'BRB', 'aus', true, ['#FFFFFF', '#1B5E20']),
  champ(18, 'Jones', 'JON', 'aus', false, ['#FFD400', '#1565C0']),
  champ(19, 'P. Hill', 'PHI', 'usa', false, ['#FFFFFF', '#C62828']),
  champ(20, 'Andretti', 'AND', 'usa', false, ['#C62828', '#FFFFFF']),
  champ(21, 'Hulme', 'HLM', 'nze', false, ['#FFFFFF', '#111111']),
  champ(22, 'Rindt', 'RIN', 'aut', false, ['#FFFFFF', '#111111']),
  champ(23, 'Lauda', 'LAU', 'aut', true, ['#C62828', '#FFFFFF']),
  champ(24, 'Fittipaldi', 'FIT', 'bra', true, ['#111111', '#FFD400']),
  champ(25, 'Piquet', 'PIQ', 'bra', true, ['#1565C0', '#C62828']),
  champ(26, 'Senna', 'SEN', 'bra', true, ['#FFD400', '#2E7D32']),
  champ(27, 'Scheckter', 'SCK', 'saf', false, ['#FFFFFF', '#1565C0']),
  champ(28, 'K. Rosberg', 'KRO', 'fin', false, ['#FDD835', '#111111']),
  champ(29, 'Häkkinen', 'HAK', 'fin', false, ['#FFFFFF', '#1565C0']),
  champ(30, 'Räikkönen', 'RAI', 'fin', false, ['#E53935', '#111111']),
  champ(31, 'Prost', 'PRO', 'fra', true, ['#FFFFFF', '#1565C0']),
  champ(32, 'Schumacher', 'MSC', 'ger', true, ['#C62828', '#FFD400']),
  champ(33, 'Vettel', 'VET', 'ger', true, ['#1E88E5', '#FFFFFF']),
  champ(34, 'N. Rosberg', 'NRO', 'ger', false, ['#FDD835', '#1565C0']),
  champ(35, 'Villeneuve', 'VIL', 'can', false, ['#1E88E5', '#FFFFFF']),
  champ(36, 'Alonso', 'ALO', 'spa', true, ['#1565C0', '#FFD400']),
  champ(37, 'Verstappen', 'VER', 'ned', true, ['#1A237E', '#E53935']),
]

export const WORLD_CUP = {
  gbr: { name: 'Great Britain', colour: '#00502D', nations: ['gbr'] },
  eur: {
    name: 'Europe',
    colour: '#003399',
    nations: ['aut', 'fin', 'fra', 'ger', 'spa', 'ned', 'ita'],
  },
  row: {
    name: 'Rest of the World',
    colour: '#C9A227',
    nations: ['arg', 'aus', 'usa', 'nze', 'bra', 'saf', 'can'],
  },
}
export const CUP_TEAM = Object.fromEntries(
  Object.entries(WORLD_CUP).flatMap(([id, t]) => t.nations.map((n) => [n, id])),
)
export const CUP_SQUAD = Object.fromEntries(
  Object.keys(WORLD_CUP).map((id) => [
    id,
    CHAMPION_DRIVERS.filter((d) => CUP_TEAM[d.team] === id).length,
  ]),
)

export const PREQUAL_PLACES = 6
export const SEEDED_PLACES = 16
