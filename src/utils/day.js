// YouTube's daily quota resets at midnight Pacific, so both the browser and the Worker have to
// agree on which day it is. No dependencies, so a Worker can import it without pulling in Dexie.
export const pacificDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)
