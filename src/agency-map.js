// Fallback agency-code → name map. The client prefers agencies.json from the
// nightly snapshot but falls back to this if the file is missing or a code is
// unrecognized.
export const AGENCY_MAP = {"0100":"Department of Agriculture","0331":"National Endowment for the Humanities","0348":"Cost Accounting Standards Board","0503":"Office of Civil Rights (USDA)","0560":"Farm Service Agency","0575":"Rural Housing Service","0579":"Animal and Plant Health Inspection Service","0580":"Agricultural Marketing Service","0581":"Grain Inspection, Packers and Stockyards Admin","0583":"Food Safety and Inspection Service","0584":"Food and Nutrition Service","0596":"Forest Service","0605":"Dept of Commerce, Office of the Secretary","0607":"Bureau of the Census","0648":"National Oceanic and Atmospheric Administration","0694":"Bureau of Industry and Security","0720":"Office of the Secretary (DOD)","0750":"Defense Acquisition Regulations Council","0906":"Health Resources and Services Administration","0910":"Food and Drug Administration","0917":"Admin for Strategic Preparedness and Response","0936":"Office of Inspector General (HHS)","0938":"Centers for Medicare & Medicaid Services","0945":"Office of the Secretary (HHS)","0970":"Administration for Children and Families","1004":"Bureau of Land Management","1010":"Bureau of Safety and Environmental Enforcement","1018":"U.S. Fish and Wildlife Service","1024":"National Park Service","1090":"Council on Environmental Quality","1093":"Bureau of Reclamation","1105":"Department of Justice","1117":"Drug Enforcement Administration","1125":"Executive Office for Immigration Review","1140":"Bureau of Alcohol, Tobacco, Firearms, and Explosives","1190":"Civil Rights Division (DOJ)","1205":"Employment and Training Administration","1210":"Employee Benefits Security Administration","1218":"Occupational Safety and Health Administration","1235":"Wage and Hour Division","1245":"Office of Federal Contract Compliance Programs","1400":"Department of State","1505":"Office of the Comptroller of the Currency","1506":"Financial Crimes Enforcement Network","1545":"Internal Revenue Service","1557":"Office of the Comptroller of the Currency","1615":"U.S. Citizenship and Immigration Services","1653":"U.S. Immigration and Customs Enforcement","1801":"Office of the Secretary (ED)","1840":"Office of Postsecondary Education","1901":"Department of Energy","1902":"Federal Energy Regulatory Commission","1990":"Nuclear Waste Technical Review Board","2009":"EPA Office of Air and Radiation","2040":"EPA Office of Chemical Safety and Pollution Prevention","2050":"EPA Office of Land and Emergency Management","2060":"EPA Office of Air and Radiation","2105":"Office of the Secretary (DOT)","2120":"Federal Aviation Administration","2126":"Federal Motor Carrier Safety Administration","2127":"National Highway Traffic Safety Administration","2137":"Pipeline and Hazardous Materials Safety Administration","2140":"Surface Transportation Board","2501":"Department of Housing and Urban Development","2502":"Office of Housing (HUD)","2506":"Community Planning and Development (HUD)","2900":"Department of Veterans Affairs","3014":"Architectural and Transportation Barriers Compliance Board","3037":"Committee for Purchase from People Who Are Blind","3038":"Commodity Futures Trading Commission","3046":"Equal Employment Opportunity Commission","3060":"Federal Communications Commission","3064":"Federal Deposit Insurance Corporation","3072":"Consumer Product Safety Commission","3084":"Federal Trade Commission","3090":"General Services Administration","3124":"Merit Systems Protection Board","3133":"National Credit Union Administration","3150":"Nuclear Regulatory Commission","3170":"Consumer Financial Protection Bureau","3206":"Office of Personnel Management","3235":"Securities and Exchange Commission","3245":"Small Business Administration","4030":"Financial Stability Oversight Council","9000":"DOD/GSA/NASA (FAR)"};

// Parent agency → child codes. Selecting a parent auto-includes all children.
export const AGENCY_GROUPS = {
  "Department of Agriculture": ["0100","0331","0348","0400","0500","0501","0503","0504","0505","0510","0524","0535","0551","0560","0563","0570","0572","0575","0578","0579","0580","0581","0583","0584","0596","0599"],
  "Department of Commerce": ["0600","0605","0607","0608","0625","0640","0648","0690","0694"],
  "Department of Defense": ["0700","0701","0702","0709","0720","0750","0790"],
  "Department of Health and Human Services": ["0900","0906","0910","0915","0917","0935","0936","0937","0938","0945","0955","0970","0980","0985","0990"],
  "Department of the Interior": ["1000","1004","1010","1012","1018","1024","1028","1029","1076","1090","1093"],
  "Department of Justice": ["1100","1103","1105","1110","1115","1117","1121","1125","1140","1190"],
  "Department of Labor": ["1200","1205","1210","1215","1218","1219","1220","1225","1230","1235","1240","1245","1250","1290"],
  "Department of State": ["1400","1405"],
  "Department of the Treasury": ["1500","1505","1506","1510","1515","1520","1530","1535","1545","1550","1557","1560"],
  "Department of Homeland Security": ["1601","1610","1611","1615","1625","1651","1652","1653","1660","1670"],
  "Department of Education": ["1800","1801","1810","1820","1830","1840","1850","1875","1890","1895"],
  "Department of Energy": ["1900","1901","1902"],
  "Environmental Protection Agency": ["2000","2009","2010","2020","2030","2040","2050","2060","2070","2080","2090"],
  "Department of Transportation": ["2100","2105","2106","2115","2120","2125","2126","2127","2130","2132","2133","2135","2137","2138","2140"],
  "Department of Housing and Urban Development": ["2500","2501","2502","2506","2528","2529","2577","2590"],
  "Department of Veterans Affairs": ["2900"],
  "Nuclear Regulatory Commission": ["3100","3150"],
  "Securities and Exchange Commission": ["3235"],
  "Federal Communications Commission": ["3060"],
  "Federal Deposit Insurance Corporation": ["3064"],
  "Office of Personnel Management": ["3206","3400"],
};

// Historical years available for the client's admin-filter buttons. Grows
// automatically as calendar years pass — 2017 through the current year.
// Note: the App loads whatever years are actually present in manifest.historical
// at runtime; this constant is a fallback and a hint for UI controls.
export const HIST_YEARS = (() => {
  const start = 2017;
  const end = new Date().getFullYear();
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
})();

export const ADMINS = [
  {id:"trump1", label:"Trump 1.0", from:"2017-01-20", to:"2021-01-20", color:"#dc2626"},
  {id:"biden",  label:"Biden",     from:"2021-01-20", to:"2025-01-20", color:"#2563eb"},
  {id:"trump2", label:"Trump 2.0", from:"2025-01-20", to:"2099-12-31", color:"#dc2626"},
];
