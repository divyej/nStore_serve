const express = require('express');
const puppeteer = require('puppeteer');
const axios = require('axios');

const cors = require('cors');
const app = express();
app.use(cors());

const port = process.env.PORT || 3001; // Use the specified port or default to 3001

// Create a global variable for the browser instance
let browser;

// Create a reusable function to log in and establish a session
const login = async () => {
  if (!browser) {
    browser = await puppeteer.launch({ headless: true, timeout: 90000 }); // Launch the browser if not already open
  }

  const page = await browser.newPage();
  await page.goto('https://www.ecatering.irctc.co.in/admin/');

  // Check if already logged in 
  const isLoggedIn = await page.evaluate(() => {
  
    return document.querySelector('a.dropdown-item span.fa-sign-out') !== null;
  });

  if (!isLoggedIn) {
    await page.type('input[name="mobile"]', '9870585107');
    await page.type('input[name="password"]', 'nStore@1234');
    await page.click('button[type="submit"]');
    await page.waitForNavigation();
  }

  return page; // Return the page object
};

// Define the orderDetail function to scrape data for a specific order
const orderDetail = async (page, orderId) => {
  console.log('Getting order details for order ID:', orderId);
  
  await page.goto(`https://www.ecatering.irctc.co.in/admin/orders/${orderId}/view`);
  
  // Wait for navigation or a specific element to appear with a timeout (e.g., 10 seconds)
  const navigationTimeout = 100000; // 10 seconds
  try {
    await Promise.race([
      page.waitForNavigation({ timeout: navigationTimeout }),
      page.waitForSelector('table tr', { timeout: navigationTimeout }),
    ]);
  } catch (error) {
    console.error('Navigation or element detection timed out:', error);
  }

  const data = await page.evaluate(() => {
    const orderDetails = [];
    const detailDataRows = document.querySelectorAll('table tr');

    for (const row of detailDataRows) {
      const columns = row.querySelectorAll('td');
      if (columns.length > 0) {
        const firstColumn = columns[0];
        if (firstColumn) {
          const item = firstColumn.textContent.trim();
          const detail = columns[1].textContent.trim(); // Use trim to remove leading/trailing whitespace
          orderDetails.push({ item, detail });
        }
      }
    }

    return orderDetails;
  });

  // Extract data from the specified element (p:nth-child(7))
  const additionalData = await page.evaluate(() => {
    const element = document.querySelector('body > admin-app-root > div.main-content > admin-order-details > div.container-fluid > div.row > div.col-xs-12.col-sm-10.col-sm-offset-1 > div > div:nth-child(2) > p:nth-child(7) > strong > span');
    return element ? element.textContent.trim() : null;
  });

  await page.goBack();
  console.log('Returned to the list of orders');

  // Include the additional data in the result
  const result = {
    orderDetails: data,
    additionalData: additionalData || 'No additional data found', // Provide a default value if no data is found
  };

  return result;
};





app.get('/scrape', async (req, res) => {
  try {
    const page = await login(); // Reuse the existing session or create a new one if needed

    // Now that you are logged in, navigate to the page with the table of orders
    await page.goto('https://www.ecatering.irctc.co.in/admin/orders');

    // Extract data from the table using page.evaluate
    const rows = await page.$$eval('table tr', (rows) => {
      return rows.map((row) => {
        const columns = row.querySelectorAll('td');

        // Check if there are at least three columns (modify as needed)
        if (columns.length >= 3) {
          const orderId = columns[0].textContent.replace("#", "");
          const customerName = columns[1].textContent;
          const orderTotal = columns[2].textContent;
          const content = columns[3].textContent;
          const content2 = columns[4].textContent;
          const content3 = columns[5].textContent;
          const content4 = columns[6].textContent;
          const status = columns[10].textContent;

          return {
            orderId,
            customerName,
            orderTotal,
            content,
            content2,
            content3,
            content4,
            status,
          };
        }
        return null;
      });
    });

    // Filter out null values (rows without enough columns)
    const validRows = rows.filter((row) => row !== null);

    const ordersData = [];
    for (const row of validRows) {
      const { orderId } = row;
      const detail = await orderDetail(page, orderId);
      ordersData.push({ ...row, detail });
    }

    // Send the scraped data as JSON response
    res.json(ordersData);
  } catch (error) {
    console.error('Error scraping data:', error);
    res.status(500).json({ error: 'Failed to scrape data' });
  }
});
app.get('/api/orders', async (req, res) => {
  try {
    const config = {
      method: 'get',
      maxBodyLength: Infinity,
      url: 'https://ondc-dashboard.nlincs.in/api/orders?sort=created_at%7Cdesc&page=1&page_size=150',
      headers: { 
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:102.0) Gecko/20100101 Firefox/102.0', 
        'Accept': 'application/json, text/plain, */*', 
        'Accept-Language': 'en-US,en;q=0.5', 
        'Accept-Encoding': 'gzip, deflate, br', 
        'Connection': 'keep-alive', 
        'Referer': 'https://ondc-dashboard.nlincs.in/orders', 
        'Cookie': '_gcl_au=1.1.1835380197.1695292355; _ga_HC9T1Q0H04=GS1.1.1695389929.3.0.1695389929.0.0.0; _ga=GA1.1.2124441449.1695292355; _fbp=fb.1.1695292356447.1335111060; auth.strategy=cookie; ondc._namespace=prod; ondc._vendor=nstore; auth._token.cookie=true; auth._token_expiration.cookie=false; ondc._session=TZ7K0KcvNi2FSisim8Fx7FLyMLQppcpx5PVxW3IdQi5gavoOSz6NCVUQfqHiSNYS2SUmWv6mZP; ondc._session.sig=83Wk-_qmmLadq6TVYWI243NJXj8', 
        'Sec-Fetch-Dest': 'empty', 
        'Sec-Fetch-Mode': 'cors', 
        'Sec-Fetch-Site': 'same-origin', 
        'TE': 'trailers'
      }
    };

    const response = await axios.request(config);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred while fetching data.' });
  }
});

app.get('/', (req, res) => {
  res.send('Server is up and running');
});

// Start the server and listen on the specified port
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
})
